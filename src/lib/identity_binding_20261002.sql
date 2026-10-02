-- ============================================================
-- PASS 본인확인 결과 결속 (2026-10-02, R1 근본 수정 — 설계 문서/커넥트립_PASS결속_설계_v2_20261002.md)
--
-- 문제(R1): 서버(api/verify-identity.js)가 identityVerificationId + 호출자가 고른 purpose 만으로 증빙을 내줬다.
--   공격자가 자기 id 로 만든 /app-identity 링크를 보내 피해자가 PASS 를 끝내면 그 결과(아이디 찾기·비밀번호
--   재설정 증빙)를 공격자가 가져갈 수 있었다.
-- 수정: 본인확인 번호(id)는 서버가 발급한다(start). 발급하는 순간 PASS 창을 띄울 페이지가 만든 비밀값 ds 의
--   sha256 과 용도를 함께 묶어 둔다(identity_starts). 증빙은 ds 원문을 가진 쪽이, 묶어 둔 용도로, 1시간 안에만
--   받을 수 있다. 클라이언트가 고른 id 는 어디서도 등록되지 않으므로 '남의 PASS 에 뒤늦게 결속'할 길이 없다.
--   결속 확인은 증빙을 기록하는 DB 함수 안에서 행 잠금과 함께 다시 한다 → 서버를 옛 배포로 되돌려도
--   (2부 권한 회수 뒤) 결속 없는 증빙은 나가지 않는다.
--
-- 적용은 두 번에 나눈다.
--   1부 identity_binding_20261002        : 추가만(테이블·함수·cron). 새 서버 배포 "전".
--   2부 identity_binding_enforce_20261002 : 옛 기록 함수 실행 권한 회수 + 옛 경로 미사용 토큰 무효화.
--                                          새 서버가 운영 도메인에 뜬 것을 확인한 "직후".
-- ============================================================

-- ==================== 1부 ====================

-- 서버 전용. 개인정보·IP 없음(id·ds 해시·용도·시각만). 24시간 뒤 정리.
CREATE TABLE IF NOT EXISTS public.identity_starts (
  provider_ref TEXT PRIMARY KEY CHECK (provider_ref ~ '^ct[0-9a-f]{32}$'),
  ds_hash      TEXT NOT NULL CHECK (ds_hash ~ '^[0-9a-f]{64}$'),
  purpose      TEXT NOT NULL CHECK (purpose IN ('signup_identity', 'password_reset', 'find_id')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_starts_created ON public.identity_starts (created_at);
ALTER TABLE public.identity_starts ENABLE ROW LEVEL SECURITY;   -- 정책 없음 = service_role(소유자 함수)만
REVOKE ALL ON public.identity_starts FROM PUBLIC, anon, authenticated;

-- 등록: 'ok' | 'exists' | 'invalid'. id 는 서버(api/verify-identity.js start)가 난수로 만든다.
CREATE OR REPLACE FUNCTION public.identity_start_register(p_provider_ref TEXT, p_ds_hash TEXT, p_purpose TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_n INT;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF COALESCE(p_provider_ref, '') !~ '^ct[0-9a-f]{32}$' OR COALESCE(p_ds_hash, '') !~ '^[0-9a-f]{64}$'
     OR COALESCE(p_purpose, '') NOT IN ('signup_identity', 'password_reset', 'find_id') THEN
    RETURN 'invalid';
  END IF;
  DELETE FROM public.identity_starts WHERE created_at < now() - interval '24 hours';
  -- 이미 결과가 기록된 id 는 다시 쓰지 않는다(서버 난수라 사실상 없음 — 방어)
  IF EXISTS (SELECT 1 FROM public.identity_verifications WHERE provider_ref = p_provider_ref) THEN
    RETURN 'exists';
  END IF;
  INSERT INTO public.identity_starts (provider_ref, ds_hash, purpose)
  VALUES (p_provider_ref, p_ds_hash, p_purpose)
  ON CONFLICT (provider_ref) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'ok' ELSE 'exists' END;
END;
$$;

-- 확인(읽기만, 포트원 호출 전): 'ok' | 'mismatch'(없음 포함) | 'purpose' | 'expired' | 'used'
-- 없음과 ds 불일치는 같은 답 — ds 를 모르는 쪽에 등록 여부를 알려 주지 않는다.
CREATE OR REPLACE FUNCTION public.identity_start_check(p_provider_ref TEXT, p_ds_hash TEXT, p_purpose TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE r public.identity_starts%ROWTYPE;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  SELECT * INTO r FROM public.identity_starts WHERE provider_ref = p_provider_ref;
  IF NOT FOUND OR r.ds_hash IS DISTINCT FROM p_ds_hash THEN RETURN 'mismatch'; END IF;
  IF r.purpose IS DISTINCT FROM p_purpose THEN RETURN 'purpose'; END IF;
  IF r.created_at < now() - interval '1 hour' THEN RETURN 'expired'; END IF;
  IF EXISTS (SELECT 1 FROM public.identity_verifications WHERE provider_ref = p_provider_ref) THEN
    RETURN 'used';
  END IF;
  RETURN 'ok';
END;
$$;

-- 결속 확인 + 기록(원자적). 'binding_invalid' | 'binding_purpose' | 'binding_expired' | 기존 기록 함수의 결과.
-- 등록 행을 잠근 채 다시 대조한 뒤 기존 record_identity_verification(차단·중복·만 14세 검사·INSERT)을 부른다.
-- 이 함수는 소유자(postgres) 권한으로 돌므로 2부에서 service_role 의 기존 함수 실행 권한을 회수해도 동작한다.
CREATE OR REPLACE FUNCTION public.record_identity_verification_bound(
  p_provider_ref TEXT, p_ds_hash TEXT,
  p_pg TEXT, p_name TEXT, p_birthdate DATE, p_gender TEXT, p_phone TEXT,
  p_operator TEXT, p_is_foreigner BOOLEAN, p_ci_hash TEXT, p_token_hash TEXT,
  p_purpose TEXT, p_ip TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE r public.identity_starts%ROWTYPE;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  SELECT * INTO r FROM public.identity_starts WHERE provider_ref = p_provider_ref FOR UPDATE;
  IF NOT FOUND OR r.ds_hash IS DISTINCT FROM p_ds_hash THEN RETURN 'binding_invalid'; END IF;
  IF r.purpose IS DISTINCT FROM p_purpose THEN RETURN 'binding_purpose'; END IF;
  IF r.created_at < now() - interval '1 hour' THEN RETURN 'binding_expired'; END IF;
  RETURN public.record_identity_verification(
    p_provider_ref, p_pg, p_name, p_birthdate, p_gender, p_phone,
    p_operator, p_is_foreigner, p_ci_hash, p_token_hash, p_purpose, p_ip);
END;
$$;

REVOKE ALL ON FUNCTION public.identity_start_register(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.identity_start_check(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_identity_verification_bound(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_start_register(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.identity_start_check(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_identity_verification_bound(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- 매시 23분 정리(등록 함수도 호출 때마다 지우지만, 호출이 없는 날에도 비우려고)
SELECT cron.schedule('identity-starts-purge', '23 * * * *',
  $job$ DELETE FROM public.identity_starts WHERE created_at < now() - interval '24 hours' $job$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'identity-starts-purge');

-- ==================== 2부 (새 서버 운영 확인 직후, 별도 마이그레이션) ====================
-- REVOKE EXECUTE ON FUNCTION public.record_identity_verification(TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT)
--   FROM service_role;
-- -- 옛 경로(결속 없이)로 발급돼 아직 쓰지 않은 증빙의 토큰을 무효화한다. 새 서버가 발급한 것(등록 행 있음)은 건드리지 않는다.
-- UPDATE public.identity_verifications iv SET consume_token_hash = NULL
--  WHERE iv.consumed_at IS NULL AND iv.consume_token_hash IS NOT NULL
--    AND NOT EXISTS (SELECT 1 FROM public.identity_starts s WHERE s.provider_ref = iv.provider_ref);

-- ==================== 되돌리기 ====================
-- 2부: GRANT EXECUTE ON FUNCTION public.record_identity_verification(TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT)
--        TO service_role;   -- 옛 서버로 되돌릴 때만. R1 이 다시 열린다.
-- 1부: SELECT cron.unschedule('identity-starts-purge') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'identity-starts-purge');
--      DROP FUNCTION IF EXISTS public.record_identity_verification_bound(TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT);
--      DROP FUNCTION IF EXISTS public.identity_start_check(TEXT, TEXT, TEXT);
--      DROP FUNCTION IF EXISTS public.identity_start_register(TEXT, TEXT, TEXT);
--      DROP TABLE IF EXISTS public.identity_starts;
