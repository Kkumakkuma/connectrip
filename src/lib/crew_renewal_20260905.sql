-- 승무원 인증 1년 갱신 (2026-09-05 쿠마님 확정: "승무원 인증은 1년마다 갱신, 회사를 옮겨도 다시 인증")
--
-- 규칙
--  · 승무원 자격(profiles.crew_verified)은 회사 메일 인증 시각(crew_verified_at)으로부터 1년간 유효.
--  · 매일 새벽 pg_cron 이 만료된 계정의 crew_verified 를 FALSE 로 내린다(승무원 전용 기능은 기존 crew_verified
--    검사 그대로 잠긴다 — 정책·RPC 를 건드리지 않는다). user_type 은 'crew' 그대로(갱신 안내 대상).
--  · 갱신 = 마이페이지에서 회사 메일 OTP(purpose 'airline_email') 후 RPC renew_crew_verification. 새 회사 메일이면
--    항공사 정보도 바뀐다(이직). 이전 회사 메일 claim 은 해제.
--  · 만료 30일 전부터 클라이언트가 crew_verified_at 으로 안내 문구를 띄운다(get_my_profile 이 컬럼을 그대로 준다).

-- 1) 만료 처리 함수 (postgres/pg_cron 이 실행. 클라이언트 롤 실행 불가)
CREATE OR REPLACE FUNCTION public.crew_verification_expire()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_n INTEGER;
BEGIN
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles
     SET crew_verified = FALSE, updated_at = NOW()
   WHERE user_type = 'crew' AND COALESCE(crew_verified, FALSE)
     AND crew_verified_at IS NOT NULL AND crew_verified_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_verification_expire() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('crew-verification-expire') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crew-verification-expire');
SELECT cron.schedule('crew-verification-expire', '20 18 * * *', $job$ SELECT public.crew_verification_expire(); $job$);  -- 03:20 KST

-- 2) 갱신 RPC (로그인한 승무원 본인)
--    'ok' 반환. 예외: 'crew airline verification required' | 'AIRLINE_EMAIL_ALREADY_CLAIMED' |
--    'AIRLINE_EMAIL_PREVIOUSLY_USED' | 'OTP_PROOF_REQUIRED_AIRLINE' | 'OTP_PROOF_INVALID_AIRLINE' | 'NOT_CREW'
CREATE OR REPLACE FUNCTION public.renew_crew_verification(p_airline_email TEXT, p_airline_name TEXT, p_airline_otp_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_uid UUID := auth.uid(); v_norm_email TEXT; v_domain TEXT; v_airline TEXT; v_canon TEXT; v_hash TEXT;
  v_owner UUID; v_prev UUID; v_otp_id UUID; v_old_email TEXT; v_old_hash TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT airline_email INTO v_old_email FROM public.profiles WHERE id = v_uid AND user_type = 'crew';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_CREW'; END IF;

  v_norm_email := lower(trim(COALESCE(p_airline_email, '')));
  v_domain := split_part(v_norm_email, '@', 2);
  SELECT domain INTO v_airline FROM public.airline_domains WHERE domain = v_domain;
  IF v_airline IS NULL THEN RAISE EXCEPTION 'crew airline verification required'; END IF;

  v_canon := public.canon_airline_email(v_norm_email);
  v_hash  := encode(extensions.digest(v_canon, 'sha256'), 'hex');
  SELECT id INTO v_owner FROM public.profiles
   WHERE public.canon_airline_email(airline_email) = v_canon AND id <> v_uid LIMIT 1;
  IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'AIRLINE_EMAIL_ALREADY_CLAIMED'; END IF;
  SELECT claimed_by INTO v_prev FROM public.airline_email_claims WHERE email_hash = v_hash AND released_at IS NULL LIMIT 1;
  IF FOUND AND v_prev IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'AIRLINE_EMAIL_PREVIOUSLY_USED'; END IF;

  IF COALESCE(btrim(p_airline_otp_token), '') = '' THEN RAISE EXCEPTION 'OTP_PROOF_REQUIRED_AIRLINE'; END IF;
  UPDATE public.email_otps SET consumed_at = NOW()
   WHERE lower(email) = v_norm_email AND verified_at IS NOT NULL
     AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
     AND purpose = 'airline_email'
     AND consume_token_hash = encode(extensions.digest(p_airline_otp_token, 'sha256'), 'hex')
  RETURNING id INTO v_otp_id;
  IF v_otp_id IS NULL THEN RAISE EXCEPTION 'OTP_PROOF_INVALID_AIRLINE'; END IF;

  -- 이직: 이전 회사 메일 claim 해제(본인 것만)
  IF v_old_email IS NOT NULL AND lower(v_old_email) <> v_norm_email THEN
    v_old_hash := encode(extensions.digest(public.canon_airline_email(lower(v_old_email)), 'sha256'), 'hex');
    UPDATE public.airline_email_claims SET released_at = NOW(), released_by = v_uid
     WHERE email_hash = v_old_hash AND claimed_by = v_uid AND released_at IS NULL;
  END IF;
  INSERT INTO public.airline_email_claims (email_hash, domain, claimed_by)
  VALUES (v_hash, v_domain, v_uid)
  ON CONFLICT (email_hash) DO UPDATE
    SET claimed_by = EXCLUDED.claimed_by, claimed_at = NOW(), released_at = NULL, released_by = NULL;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET
    airline_email = v_norm_email,
    airline_name = COALESCE(NULLIF(btrim(p_airline_name), ''), v_airline),
    email = v_norm_email,                 -- 승무원 연락 메일 = 회사 메일(쿠마님 정책)
    crew_verified = TRUE, crew_verified_at = NOW(), updated_at = NOW()
  WHERE id = v_uid;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.renew_crew_verification(TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_crew_verification(TEXT,TEXT,TEXT) TO authenticated, service_role;

-- 확인
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'crew-verification-expire';
-- SELECT public.crew_verification_expire();  -- 0 (만료 대상 없음)
