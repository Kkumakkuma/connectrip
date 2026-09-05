-- OTP 코드 해시 저장 (2026-09-05 보안 감사 ⑤) — 2026-09-05 운영 적용.
--
-- 문제: phone_otps.code / email_otps.code 에 6자리 인증번호가 평문으로 남아 있었다.
--       그 두 테이블을 읽을 수 있는 경로가 하나라도 생기면(백업 유출·service_role 키 유출·
--       읽기 전용 접근) 문자·메일을 받지 못한 사람이 그대로 본인확인을 통과한다.
-- 조치: 저장·비교를 HMAC-SHA256 해시(code_hash)로 바꾼다.
--       6자리는 경우의 수가 100만이라 페퍼 없는 해시는 즉시 전수대입되므로 반드시 HMAC 이다.
--       비밀(키)은 Supabase Vault 의 ct_otp_hash_key_v1 에 두고, 서버리스는 service_role 전용 RPC
--       otp_hash_secret() 로 읽어 Node 에서 HMAC 을 계산한다(api/_otp_hash.js). Vercel 환경변수
--       OTP_HASH_SECRET 이 있으면 그것이 우선한다(등록은 선택).
--
-- ===== 적용 순서 (반드시 이 순서) ==========================================================
--   1) 이 파일 실행 (Supabase). Vault 비밀·RPC·컬럼·검증 함수가 만들어진다.
--      옛 코드는 5인자로 호출해도 p_code_hash 가 기본값 NULL 이라 평문 분기로 정상 동작한다(무중단).
--   2) main push → Vercel 배포.
--   순서를 바꾸면 안 되는 이유: 코드가 먼저 나가면 code_hash 컬럼·RPC 가 없어 발송이 전부 실패한다.
--
--   ⚠ 알려진 짧은 창: 배포 전환 순간에 "새 인스턴스가 보낸 코드"를 "아직 살아 있는 옛 인스턴스"가
--     검증하면 p_code_hash 를 안 보내므로 불일치가 난다(길어야 수 초). 사용자는 재발송하면 된다.
--     정상 사용자에게만 영향이 있고 우회는 열리지 않는다(해시 행은 평문으로 통과 불가).
--
--   ⚠ 키 회전 절차: Vault 값을 바꾸면 그 전에 발급된 해시는 전부 검증 불가가 되고, 서버리스
--     인스턴스는 최대 5분 캐시를 들고 있다. OTP 수명이 5분이므로 발송이 없는 시간대에 바꾸거나,
--     바꾼 뒤 사용자에게 재발송을 안내한다.
-- =========================================================================================
--
-- 롤백: 아래 함수를 security_hardening.sql 5-6b 정의로 되돌리면 된다(컬럼은 남겨도 무해).
--       단 그 사이 발급된 행은 code 가 NULL 이라 검증 불가 — 5분 뒤 만료되므로 재발송하면 된다.

-- ----------------------------------------------------------------------------------------
-- 0. 비밀: Vault + service_role 전용 RPC (플래너 청소 토큰 ct_planner_purge_secret 과 같은 방식)
-- ----------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ct_otp_hash_key_v1') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'ct_otp_hash_key_v1',
      'OTP 코드 HMAC 키 (phone_otps/email_otps.code_hash). 서버리스가 otp_hash_secret() 로 읽는다.'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.otp_hash_secret()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ct_otp_hash_key_v1' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.otp_hash_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.otp_hash_secret() TO service_role;

-- ----------------------------------------------------------------------------------------
-- 1. 컬럼: 해시 저장소 추가 + 평문 컬럼의 NOT NULL 해제
--    (발송 API 가 code 를 아예 채우지 않으므로 NOT NULL 이면 insert 가 실패한다)
-- ----------------------------------------------------------------------------------------
ALTER TABLE public.phone_otps ADD COLUMN IF NOT EXISTS code_hash TEXT;
ALTER TABLE public.email_otps ADD COLUMN IF NOT EXISTS code_hash TEXT;

ALTER TABLE public.phone_otps ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.email_otps ALTER COLUMN code DROP NOT NULL;

-- 인덱스는 새로 만들지 않는다. 조회는 phone/email + created_at 으로만 하고(기존 인덱스 사용),
-- code_hash 는 이미 찾은 1행과 대조만 하므로 인덱스를 걸 이유가 없다(오히려 해시가 색인에 남는다).

-- ----------------------------------------------------------------------------------------
-- 2. 즉시 정리: 이미 쓸모가 없어진 평문 코드를 지운다.
--    검증 완료됐거나 만료된 행은 code 를 다시 볼 일이 없다. 살아 있는 행(최대 5분)만 남는다.
-- ----------------------------------------------------------------------------------------
UPDATE public.phone_otps SET code = NULL
 WHERE code IS NOT NULL AND (verified_at IS NOT NULL OR expires_at < NOW());
UPDATE public.email_otps SET code = NULL
 WHERE code IS NOT NULL AND (verified_at IS NOT NULL OR expires_at < NOW());

-- ----------------------------------------------------------------------------------------
-- 3. 검증 RPC 교체 (security_hardening.sql 5-6b 의 후속 버전)
--    구 5인자 시그니처는 반드시 DROP 한다. 남겨 두면 6인자 버전과 함께 존재해
--    이름 붙인 인자 호출이 "function is not unique" 로 모호해진다(complete_signup_profile 과 같은 이유).
-- ----------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_otp_and_issue_token(TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION public.verify_otp_and_issue_token(
  p_kind TEXT, p_subject TEXT, p_code TEXT, p_token_hash TEXT,
  p_purpose TEXT DEFAULT 'generic', p_code_hash TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID; v_code TEXT; v_code_hash TEXT; v_attempts INT; v_updated UUID; v_match BOOLEAN;
BEGIN
  IF p_kind NOT IN ('email','phone') THEN RAISE EXCEPTION 'invalid kind'; END IF;
  IF COALESCE(btrim(p_token_hash),'') = '' THEN RAISE EXCEPTION 'token hash required'; END IF;

  IF p_kind = 'email' THEN
    SELECT id, code, code_hash, COALESCE(attempts,0)
      INTO v_id, v_code, v_code_hash, v_attempts
      FROM public.email_otps
     WHERE lower(email) = lower(p_subject) AND verified_at IS NULL AND expires_at >= NOW()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  ELSE
    SELECT id, code, code_hash, COALESCE(attempts,0)
      INTO v_id, v_code, v_code_hash, v_attempts
      FROM public.phone_otps
     WHERE phone = p_subject AND verified_at IS NULL AND expires_at >= NOW()
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN RETURN 'not_found'; END IF;
  IF v_attempts >= 5 THEN RETURN 'too_many_attempts'; END IF;

  IF v_code_hash IS NOT NULL THEN
    -- 정상 경로. 해시가 있으면 해시로만 판정한다 — 평문 인자로는 절대 통과시키지 않는다.
    v_match := (COALESCE(btrim(p_code_hash),'') <> '' AND v_code_hash = p_code_hash);
  ELSIF v_code IS NOT NULL THEN
    -- ⏳ 전환기 폴백(이 배포 이전에 발급된 행 전용). OTP 수명이 5분이라 배포 후 5분이면 소멸한다.
    --    ▶ 제거 시점: 배포 다음 날 아래 두 줄과 이 분기를 통째로 지우고 함수를 다시 만든다.
    --      UPDATE public.phone_otps SET code = NULL WHERE code IS NOT NULL;
    --      UPDATE public.email_otps SET code = NULL WHERE code IS NOT NULL;
    --      (그 뒤 ALTER TABLE ... DROP COLUMN code 까지 가면 이 분기는 컴파일도 안 된다)
    v_match := (v_code = p_code);
  ELSE
    v_match := FALSE;  -- 해시도 평문도 없는 행은 통과 불가(fail-closed)
  END IF;

  IF NOT v_match THEN
    IF p_kind = 'email' THEN
      UPDATE public.email_otps SET attempts = COALESCE(attempts,0) + 1 WHERE id = v_id;
    ELSE
      UPDATE public.phone_otps SET attempts = COALESCE(attempts,0) + 1 WHERE id = v_id;
    END IF;
    RETURN 'mismatch';
  END IF;

  IF p_kind = 'email' THEN
    UPDATE public.email_otps
       SET verified_at = NOW(), consume_token_hash = p_token_hash, purpose = COALESCE(p_purpose,'generic')
     WHERE id = v_id AND verified_at IS NULL AND expires_at >= NOW()
     RETURNING id INTO v_updated;
  ELSE
    UPDATE public.phone_otps
       SET verified_at = NOW(), consume_token_hash = p_token_hash, purpose = COALESCE(p_purpose,'generic')
     WHERE id = v_id AND verified_at IS NULL AND expires_at >= NOW()
     RETURNING id INTO v_updated;
  END IF;

  IF v_updated IS NULL THEN RETURN 'not_found'; END IF;  -- 경쟁에서 밀림 → 성공 응답 금지
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.verify_otp_and_issue_token(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
-- service_role 에는 명시적으로 준다. Supabase 기본 권한(ALTER DEFAULT PRIVILEGES)이 붙어 있어
-- 대개는 없어도 되지만, DROP → CREATE 로 새 함수 객체가 만들어지는 자리라 확인 사살한다.
-- 이게 빠지고 기본 권한이 안 걸리면 "permission denied for function" 으로 인증이 통째로 막힌다.
GRANT EXECUTE ON FUNCTION public.verify_otp_and_issue_token(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

-- PostgREST 스키마 캐시 갱신. 함수 시그니처가 바뀐 직후 캐시가 늦게 돌면
-- supabase-js rpc 가 PGRST202(함수 못 찾음)로 잠깐 실패한다.
NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------------------
-- 4. 적용 후 확인 쿼리 (SQL Editor 에서 눈으로 볼 것)
-- ----------------------------------------------------------------------------------------
-- 4-1. 함수가 하나만 남았는지(6인자 1건이어야 한다)
-- SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'verify_otp_and_issue_token';
--
-- 4-2. 배포 뒤 새로 발급된 행이 해시만 갖고 있는지
-- SELECT created_at, code IS NULL AS code_null, code_hash IS NOT NULL AS hashed
--   FROM public.phone_otps ORDER BY created_at DESC LIMIT 5;
-- SELECT created_at, code IS NULL AS code_null, code_hash IS NOT NULL AS hashed
--   FROM public.email_otps ORDER BY created_at DESC LIMIT 5;
--
-- 4-3. 남은 평문이 없는지(전환기 종료 후 0 이어야 한다)
-- SELECT (SELECT count(*) FROM public.phone_otps WHERE code IS NOT NULL) AS phone_plain,
--        (SELECT count(*) FROM public.email_otps WHERE code IS NOT NULL) AS email_plain;
