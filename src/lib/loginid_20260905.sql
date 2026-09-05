-- 아이디(login_id) 로그인 전환 (2026-09-05, 쿠마님 확정) — 운영 적용 기록.
--
-- 정책: 계정 식별자 = 아이디(영문 소문자·숫자·밑줄 4~20자). 본인확인 = PASS 하나. 이메일은 인증번호(OTP):
--       여행자 = 개인 이메일 1회(purpose 'signup'), 승무원 = 회사 이메일 1회('airline_email', 증빙 겸 연락 메일).
-- 구조: Supabase Auth 는 아이디를 모르므로 Auth email 은 합성 주소 <login_id>@id.connecttrip.co.kr (수신 불가,
--       Confirm email OFF 필수). 실제 연락 이메일은 profiles.email. 가입 계정 생성은 브라우저가 아니라
--       서버(api/signup.js, service_role)가 증빙을 확인한 뒤 auth.admin.createUser 로 한다 — 클라이언트 signUp 을
--       그대로 두면 누구나 남의 아이디의 합성 주소를 먼저 만들어 선점할 수 있다(codex 치명 지적).
--       OAuth(구글) 가입자는 Auth email 이 실제 구글 주소이고 /signup/complete 에서 아이디를 정한다.
-- 비밀번호 찾기: 아이디 + PASS 본인확인(purpose 'password_reset') → CI 가 계정의 CI 와 일치하면
--       서버가 auth.admin.updateUserById + 전체 세션 폐기(revoke_user_sessions). 이메일 인증번호 방식 없음.
-- 적용 순서: 1) 이 파일(DB) → 2) 서버 API + 클라이언트 배포 → 3) 시험 계정 3개 이행(맨 아래 §7, 계정별로
--       로그인 확인) → 4) 안정화 후 구 recovery 라우트 정리.

-- ----------------------------------------------------------------------------------------
-- 1. profiles.login_id
-- ----------------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_id TEXT;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_login_id_format;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_login_id_format
  CHECK (login_id IS NULL OR login_id ~ '^[a-z0-9_]{4,20}$');
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_login_id ON public.profiles (login_id) WHERE login_id IS NOT NULL;
-- 클라이언트 롤은 profiles.login_id 를 읽지 못한다(이메일과 같은 취급). 본인 것은 get_my_profile 류 RPC 로.
REVOKE SELECT (login_id) ON public.profiles FROM anon, authenticated;

-- 예약어: 시스템 경로·역할·혼동 유발 아이디 (agy·codex 지적 반영)
CREATE OR REPLACE FUNCTION public.login_id_reserved(p_login_id TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_login_id = ANY (ARRAY[
    'admin','administrator','root','system','support','help','staff','operator','manager','master',
    'connecttrip','connectrip','crew','official','notice','null','undefined','none','anonymous','guest',
    'login','logout','signup','signin','register','api','auth','user','users','me','profile','settings',
    'terms','privacy','policy','contact','info','mail','email','postmaster','webmaster','noreply','no_reply',
    'test','tester','payment','points','planner','board','dm'
  ]);
$$;

-- 정규화 + 형식 검사. 유효하면 소문자 아이디, 아니면 NULL.
CREATE OR REPLACE FUNCTION public.normalize_login_id(p_raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(btrim(COALESCE(p_raw,''))) ~ '^[a-z0-9_]{4,20}$'
              THEN lower(btrim(p_raw)) ELSE NULL END;
$$;

-- 중복 확인(가입 화면). 존재 여부만 boolean 으로. 예약어도 '사용 불가'로 답한다.
CREATE OR REPLACE FUNCTION public.check_login_id_taken(p_login_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN public.normalize_login_id(p_login_id) IS NULL THEN TRUE
    WHEN public.login_id_reserved(public.normalize_login_id(p_login_id)) THEN TRUE
    ELSE EXISTS (SELECT 1 FROM public.profiles WHERE login_id = public.normalize_login_id(p_login_id))
      OR EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = public.normalize_login_id(p_login_id) || '@id.connecttrip.co.kr')
  END;
$$;
REVOKE ALL ON FUNCTION public.check_login_id_taken(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_login_id_taken(TEXT) TO anon, authenticated, service_role;

-- 시험 계정 포인트 하한표: 이메일 키 → user_id 키 (연락 이메일이 바뀌어도 깨지지 않게)
ALTER TABLE public.test_account_floors ADD COLUMN IF NOT EXISTS user_id UUID;
UPDATE public.test_account_floors f SET user_id = p.id
  FROM public.profiles p WHERE f.user_id IS NULL AND lower(p.email) = lower(f.email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_account_floors_user ON public.test_account_floors (user_id) WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------------------
-- 2. handle_new_user: 합성 주소는 profiles.email 에 넣지 않는다(연락 이메일은 가입 완료 RPC 가 채운다)
-- ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  meta JSONB;
  v_bd DATE;
  v_provider TEXT;
  v_synthetic BOOLEAN;
BEGIN
  meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_provider := COALESCE(NULLIF(NEW.raw_app_meta_data->>'provider', ''), 'email');
  v_synthetic := lower(COALESCE(NEW.email, '')) LIKE '%@id.connecttrip.co.kr';
  v_bd := CASE WHEN (meta->>'birthdate') ~ '^\d{4}-\d{2}-\d{2}$'
               THEN (meta->>'birthdate')::date ELSE NULL END;
  IF v_bd IS NOT NULL AND v_bd > (CURRENT_DATE - INTERVAL '14 years') THEN
    RAISE EXCEPTION 'age_under_14';
  END IF;
  IF v_provider = 'email' AND v_bd IS NULL THEN
    RAISE EXCEPTION 'birthdate required';
  END IF;

  INSERT INTO public.profiles (
    id, email, name, nickname, phone,
    address_zipcode, address_road, address_detail,
    avatar_url, provider, referred_by,
    user_type, phone_verified, identity_verified, verification_method,
    crew_verified, profile_completed
  ) VALUES (
    NEW.id,
    CASE WHEN v_synthetic THEN NULL ELSE NEW.email END,
    COALESCE(meta->>'name', meta->>'full_name', CASE WHEN v_synthetic THEN NULL ELSE split_part(NEW.email, '@', 1) END, ''),
    NULLIF(meta->>'nickname', ''),
    NULLIF(regexp_replace(COALESCE(meta->>'phone',''), '[^0-9]', '', 'g'), ''),
    NULLIF(meta->>'address_zipcode', ''),
    NULLIF(meta->>'address_road', ''),
    NULLIF(meta->>'address_detail', ''),
    NULLIF(meta->>'avatar_url', ''),
    v_provider,
    NULL,
    'traveler', FALSE, FALSE, 'pending', FALSE, FALSE
  );

  INSERT INTO public.profiles_private (user_id, birthdate)
  VALUES (NEW.id, v_bd)
  ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------------------
-- 3. 가입 완료: 내부 함수(_for) + 래퍼 2개
--    - complete_signup_profile(...)        인증된 사용자 본인(OAuth 가입자의 /signup/complete)
--    - complete_signup_profile_admin(...)  service_role 전용(api/signup.js 가 auth.admin.createUser 직후 호출)
--    구 16인자 함수는 DROP (p_phone_otp_token 경로 폐지).
-- ----------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT);

CREATE OR REPLACE FUNCTION public.complete_signup_profile_for(
  p_user UUID,
  p_login_id TEXT, p_email TEXT, p_email_otp_token TEXT,
  p_name TEXT, p_nickname TEXT, p_phone TEXT, p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT, p_referred_by UUID,
  p_birthdate DATE, p_airline_otp_token TEXT,
  p_terms_agreed_at TIMESTAMPTZ, p_privacy_agreed_at TIMESTAMPTZ, p_identity_token TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_crew BOOLEAN := FALSE; v_clean_phone TEXT; v_ref UUID; v_domain TEXT;
  v_norm_email TEXT; v_canon TEXT; v_hash TEXT; v_otp_id UUID; v_owner UUID;
  v_airline TEXT; v_prev UUID; v_blocked BOOLEAN;
  v_policy_version CONSTANT TEXT := '2026-09-02';
  v_name TEXT; v_birthdate DATE;
  v_idv_id UUID; v_idv_name TEXT; v_idv_birthdate DATE; v_idv_phone TEXT; v_idv_ci_hash TEXT;
  v_idv_provider TEXT; v_idv_pg TEXT; v_idv_operator TEXT; v_idv_foreigner BOOLEAN; v_idv_gender TEXT;
  v_constraint TEXT;
  v_login_id TEXT; v_contact TEXT; v_auth_email TEXT; v_provider TEXT; v_synthetic BOOLEAN;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_terms_agreed_at IS NULL OR p_privacy_agreed_at IS NULL THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF p_user_type NOT IN ('traveler', 'crew') THEN RAISE EXCEPTION 'invalid user_type'; END IF;

  SELECT lower(email), COALESCE(NULLIF(raw_app_meta_data->>'provider',''),'email')
    INTO v_auth_email, v_provider FROM auth.users WHERE id = p_user;
  IF v_auth_email IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  v_synthetic := v_auth_email LIKE '%@id.connecttrip.co.kr';

  -- 아이디: 형식·예약어·중복. 합성 주소 계정은 아이디와 주소가 반드시 일치해야 한다.
  v_login_id := public.normalize_login_id(p_login_id);
  IF v_login_id IS NULL THEN RAISE EXCEPTION 'LOGIN_ID_INVALID'; END IF;
  IF public.login_id_reserved(v_login_id) THEN RAISE EXCEPTION 'LOGIN_ID_RESERVED'; END IF;
  IF v_synthetic AND v_auth_email <> v_login_id || '@id.connecttrip.co.kr' THEN RAISE EXCEPTION 'LOGIN_ID_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE login_id = v_login_id AND id <> p_user) THEN RAISE EXCEPTION 'LOGIN_ID_TAKEN'; END IF;

  -- 본인확인(PASS)은 항상 필수 (identity_required 플래그와 무관하게 이 함수는 PASS 증빙만 받는다)
  v_name := btrim(COALESCE(p_name, ''));
  v_birthdate := p_birthdate;
  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF COALESCE(btrim(p_identity_token), '') = '' THEN RAISE EXCEPTION 'IDENTITY_REQUIRED'; END IF;
  UPDATE public.identity_verifications
     SET consumed_at = NOW(), consumed_by = p_user
   WHERE consume_token_hash = encode(extensions.digest(p_identity_token, 'sha256'), 'hex')
     AND purpose = 'signup_identity'
     AND verified_at > NOW() - INTERVAL '1 hour'
     AND consumed_at IS NULL AND consumed_by IS NULL
  RETURNING id, name, birthdate, phone, ci_hash, provider, pg, operator, is_foreigner, gender
    INTO v_idv_id, v_idv_name, v_idv_birthdate, v_idv_phone, v_idv_ci_hash,
         v_idv_provider, v_idv_pg, v_idv_operator, v_idv_foreigner, v_idv_gender;
  IF v_idv_id IS NULL OR v_idv_ci_hash IS NULL THEN RAISE EXCEPTION 'IDENTITY_PROOF_INVALID'; END IF;
  v_name := v_idv_name; v_birthdate := v_idv_birthdate; v_clean_phone := v_idv_phone;
  IF EXISTS (SELECT 1 FROM public.blocked_identity_claims WHERE ci_hash = v_idv_ci_hash AND released_at IS NULL) THEN
    RAISE EXCEPTION 'IDENTITY_BLOCKED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles_identity WHERE ci_hash = v_idv_ci_hash AND user_id <> p_user) THEN
    RAISE EXCEPTION 'IDENTITY_ALREADY_REGISTERED';
  END IF;

  IF v_name = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF v_birthdate IS NULL THEN RAISE EXCEPTION 'birthdate required'; END IF;
  IF v_birthdate > CURRENT_DATE OR v_birthdate < DATE '1900-01-01' THEN RAISE EXCEPTION 'birthdate invalid'; END IF;
  IF v_birthdate > (CURRENT_DATE - INTERVAL '14 years') THEN RAISE EXCEPTION 'age_under_14'; END IF;

  SELECT TRUE INTO v_blocked FROM public.blocked_phone_claims
   WHERE phone_hash = pii.phone_hash(v_clean_phone) AND released_at IS NULL LIMIT 1;
  IF v_blocked THEN RAISE EXCEPTION 'PHONE_BLOCKED'; END IF;
  SELECT id INTO v_owner FROM public.profiles
   WHERE public.canon_phone(phone) = public.canon_phone(v_clean_phone) AND id <> p_user LIMIT 1;
  IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'PHONE_ALREADY_CLAIMED'; END IF;

  -- 연락 이메일
  IF p_user_type = 'crew' THEN
    v_norm_email := lower(trim(COALESCE(p_airline_email, '')));
    v_domain := split_part(v_norm_email, '@', 2);
    SELECT domain INTO v_airline FROM public.airline_domains WHERE domain = v_domain;
    v_crew := (v_airline IS NOT NULL);
    IF NOT v_crew THEN RAISE EXCEPTION 'crew airline verification required'; END IF;
    v_canon := public.canon_airline_email(v_norm_email);
    v_hash  := encode(extensions.digest(v_canon, 'sha256'), 'hex');
    SELECT id INTO v_owner FROM public.profiles
     WHERE public.canon_airline_email(airline_email) = v_canon AND id <> p_user LIMIT 1;
    IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'AIRLINE_EMAIL_ALREADY_CLAIMED'; END IF;
    SELECT claimed_by INTO v_prev FROM public.airline_email_claims WHERE email_hash = v_hash AND released_at IS NULL LIMIT 1;
    IF FOUND AND v_prev IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'AIRLINE_EMAIL_PREVIOUSLY_USED'; END IF;
    IF COALESCE(btrim(p_airline_otp_token), '') = '' THEN RAISE EXCEPTION 'OTP_PROOF_REQUIRED_AIRLINE'; END IF;
    UPDATE public.email_otps SET consumed_at = NOW()
     WHERE lower(email) = v_norm_email AND verified_at IS NOT NULL
       AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
       AND purpose = 'airline_email'
       AND consume_token_hash = encode(extensions.digest(p_airline_otp_token, 'sha256'), 'hex')
    RETURNING id INTO v_otp_id;
    IF v_otp_id IS NULL THEN RAISE EXCEPTION 'OTP_PROOF_INVALID_AIRLINE'; END IF;
    INSERT INTO public.airline_email_claims (email_hash, domain, claimed_by)
    VALUES (v_hash, v_domain, p_user)
    ON CONFLICT (email_hash) DO UPDATE
      SET claimed_by = EXCLUDED.claimed_by, claimed_at = NOW(), released_at = NULL, released_by = NULL;
    v_contact := v_norm_email;  -- 승무원: 회사 메일이 연락 메일(쿠마님 확정, 두 번 인증 안 함)
  ELSE
    v_contact := lower(trim(COALESCE(p_email, '')));
    IF v_contact !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN RAISE EXCEPTION 'EMAIL_INVALID'; END IF;
    IF v_provider <> 'email' AND v_contact = v_auth_email THEN
      NULL; -- OAuth(구글) 가입자: 제공자가 검증한 주소를 연락 이메일로 인정(추가 OTP 없음)
    ELSE
      IF COALESCE(btrim(p_email_otp_token), '') = '' THEN RAISE EXCEPTION 'OTP_PROOF_REQUIRED_EMAIL'; END IF;
      UPDATE public.email_otps SET consumed_at = NOW()
       WHERE lower(email) = v_contact AND verified_at IS NOT NULL
         AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
         AND purpose = 'signup'
         AND consume_token_hash = encode(extensions.digest(p_email_otp_token, 'sha256'), 'hex')
      RETURNING id INTO v_otp_id;
      IF v_otp_id IS NULL THEN RAISE EXCEPTION 'OTP_PROOF_INVALID_EMAIL'; END IF;
    END IF;
  END IF;
  -- 연락 이메일 중복(다른 계정)
  SELECT id INTO v_owner FROM public.profiles WHERE lower(email) = v_contact AND id <> p_user LIMIT 1;
  IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'EMAIL_ALREADY_CLAIMED'; END IF;

  v_ref := p_referred_by;
  IF v_ref = p_user THEN v_ref := NULL; END IF;
  IF v_ref IS NOT NULL THEN
    SELECT CASE WHEN (user_type = 'crew' AND COALESCE(crew_verified, FALSE)) THEN v_ref ELSE NULL END
      INTO v_ref FROM public.profiles WHERE id = v_ref;
  END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET
    login_id = v_login_id, email = v_contact,
    name = v_name, nickname = p_nickname, phone = v_clean_phone, phone_verified = TRUE,
    verification_method = 'carrier_auth', identity_verified = TRUE, verified_at = NOW(), verification_required = FALSE,
    address_zipcode = p_zipcode, address_road = p_road, address_detail = p_detail,
    user_type = p_user_type,
    airline_email = CASE WHEN v_crew THEN v_norm_email ELSE airline_email END,
    airline_name  = CASE WHEN v_crew THEN COALESCE(p_airline_name, v_airline) ELSE airline_name END,
    crew_verified = CASE WHEN v_crew THEN TRUE ELSE crew_verified END,
    crew_verified_at = CASE WHEN v_crew THEN NOW() ELSE crew_verified_at END,
    referred_by = COALESCE(referred_by, v_ref), profile_completed = TRUE, updated_at = NOW()
  WHERE id = p_user;

  INSERT INTO public.profiles_identity (user_id, ci_hash, provider, pg, operator, is_foreigner, gender, verified_at)
  VALUES (p_user, v_idv_ci_hash, v_idv_provider, v_idv_pg, v_idv_operator, v_idv_foreigner, v_idv_gender, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET ci_hash = EXCLUDED.ci_hash, provider = EXCLUDED.provider, pg = EXCLUDED.pg,
        operator = EXCLUDED.operator, is_foreigner = EXCLUDED.is_foreigner, gender = EXCLUDED.gender, verified_at = NOW();
  UPDATE public.identity_verifications
     SET name = NULL, birthdate = NULL, phone = NULL, gender = NULL, operator = NULL,
         is_foreigner = NULL, ci_hash = NULL, ip_address = NULL
   WHERE id = v_idv_id;

  INSERT INTO public.profiles_private (user_id, birthdate) VALUES (p_user, v_birthdate)
  ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;

  INSERT INTO public.user_consents (user_id, policy_type, policy_version) VALUES (p_user, 'terms', v_policy_version);
  INSERT INTO public.user_consents (user_id, policy_type, policy_version) VALUES (p_user, 'privacy', v_policy_version);
  INSERT INTO public.user_consents (user_id, policy_type, policy_version) VALUES (p_user, 'age14', v_policy_version);

  IF v_ref IS NOT NULL THEN PERFORM public.grant_referral_bonus(p_user); END IF;
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  IF v_constraint = 'profiles_identity_ci_hash_key' THEN RAISE EXCEPTION 'IDENTITY_ALREADY_REGISTERED'; END IF;
  IF v_constraint IN ('uq_profiles_phone_canon', 'uq_profiles_phone_hash') THEN RAISE EXCEPTION 'PHONE_ALREADY_CLAIMED'; END IF;
  IF v_constraint = 'uq_profiles_login_id' THEN RAISE EXCEPTION 'LOGIN_ID_TAKEN'; END IF;
  IF v_constraint = 'profiles_nickname_key' THEN RAISE EXCEPTION 'NICKNAME_TAKEN'; END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_signup_profile_for(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- 래퍼 1: 로그인한 본인(OAuth 가입자의 /signup/complete)
CREATE OR REPLACE FUNCTION public.complete_signup_profile(
  p_login_id TEXT, p_email TEXT, p_email_otp_token TEXT,
  p_name TEXT, p_nickname TEXT, p_phone TEXT, p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT, p_referred_by UUID,
  p_birthdate DATE DEFAULT NULL, p_airline_otp_token TEXT DEFAULT NULL,
  p_terms_agreed_at TIMESTAMPTZ DEFAULT NULL, p_privacy_agreed_at TIMESTAMPTZ DEFAULT NULL, p_identity_token TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  PERFORM public.complete_signup_profile_for(auth.uid(), p_login_id, p_email, p_email_otp_token,
    p_name, p_nickname, p_phone, p_zipcode, p_road, p_detail, p_user_type, p_airline_email, p_airline_name,
    p_referred_by, p_birthdate, p_airline_otp_token, p_terms_agreed_at, p_privacy_agreed_at, p_identity_token);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) TO authenticated, service_role;

-- 래퍼 2: service_role 전용 (api/signup.js). p_user 를 명시.
CREATE OR REPLACE FUNCTION public.complete_signup_profile_admin(
  p_user UUID,
  p_login_id TEXT, p_email TEXT, p_email_otp_token TEXT,
  p_name TEXT, p_nickname TEXT, p_phone TEXT, p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT, p_referred_by UUID,
  p_birthdate DATE DEFAULT NULL, p_airline_otp_token TEXT DEFAULT NULL,
  p_terms_agreed_at TIMESTAMPTZ DEFAULT NULL, p_privacy_agreed_at TIMESTAMPTZ DEFAULT NULL, p_identity_token TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  PERFORM public.complete_signup_profile_for(p_user, p_login_id, p_email, p_email_otp_token,
    p_name, p_nickname, p_phone, p_zipcode, p_road, p_detail, p_user_type, p_airline_email, p_airline_name,
    p_referred_by, p_birthdate, p_airline_otp_token, p_terms_agreed_at, p_privacy_agreed_at, p_identity_token);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_signup_profile_admin(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_signup_profile_admin(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT) TO service_role;

-- 아이디로 계정·연락 이메일 조회(service_role 전용, 비밀번호 찾기용). 없으면 빈 결과.
CREATE OR REPLACE FUNCTION public.login_id_contact(p_login_id TEXT)
RETURNS TABLE (user_id UUID, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
  SELECT id, email FROM public.profiles WHERE login_id = public.normalize_login_id(p_login_id) AND email IS NOT NULL LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.login_id_contact(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_id_contact(TEXT) TO service_role;

-- ----------------------------------------------------------------------------------------
-- 4. 비밀번호 찾기 = 아이디 + PASS 본인확인 (쿠마님 확정 2026-09-05 13:17). 이메일 인증번호 방식은 쓰지 않는다.
--    api/verify-identity.js 가 purpose='password_reset' 로 증빙을 남기면, 서버가 아이디로 계정을 찾고
--    이 RPC 로 "증빙의 CI == 그 계정의 CI(profiles_identity)" 를 원자적으로 확인·소비한다.
--    회사 메일을 잃은 승무원도 PASS 만 되면 비밀번호를 되찾는다.
-- ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.password_reset_by_identity(p_user UUID, p_identity_token TEXT)
RETURNS TEXT   -- 'ok' | 'proof_invalid' | 'mismatch'
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_idv_id UUID; v_ci TEXT; v_account_ci TEXT;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_user IS NULL OR COALESCE(btrim(p_identity_token), '') = '' THEN RETURN 'proof_invalid'; END IF;

  -- 증빙 소비(1회): purpose 가 password_reset 이고 1시간 안, 미소비
  UPDATE public.identity_verifications
     SET consumed_at = NOW(), consumed_by = p_user
   WHERE consume_token_hash = encode(extensions.digest(p_identity_token, 'sha256'), 'hex')
     AND purpose = 'password_reset'
     AND verified_at > NOW() - INTERVAL '1 hour'
     AND consumed_at IS NULL AND consumed_by IS NULL
  RETURNING id, ci_hash INTO v_idv_id, v_ci;
  IF v_idv_id IS NULL OR v_ci IS NULL THEN RETURN 'proof_invalid'; END IF;

  -- 증빙 행의 개인정보는 즉시 파기(가입 흐름과 동일)
  UPDATE public.identity_verifications
     SET name = NULL, birthdate = NULL, phone = NULL, gender = NULL, operator = NULL,
         is_foreigner = NULL, ci_hash = NULL, ip_address = NULL
   WHERE id = v_idv_id;

  SELECT ci_hash INTO v_account_ci FROM public.profiles_identity WHERE user_id = p_user;
  IF v_account_ci IS NULL OR v_account_ci <> v_ci THEN RETURN 'mismatch'; END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.password_reset_by_identity(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.password_reset_by_identity(UUID,TEXT) TO service_role;

-- 세션 전부 폐기(비밀번호 재설정 성공 직후). supabase-js admin.signOut 은 사용자 JWT 가 필요해 서버에서 못 쓴다.
-- auth.sessions 를 지우면 refresh_tokens 는 FK CASCADE 로 함께 사라진다. 이미 발급된 access JWT 는 만료까지 유효.
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_n INTEGER;
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(UUID) TO service_role;

-- privacy_scrub 가 챙기기 전까지의 정리(하루 지난 행 삭제)는 password_reset_issue 가 아니라 별도 cron 없이
-- 단순 보관 — 행이 작고 만료·소비 상태만 남는다. (다음 개정 때 privacy_scrub 에 흡수)

-- ----------------------------------------------------------------------------------------
-- 4b. 추천 승무원 찾기: 이메일 외에 아이디로도. profiles_guard: 시험 계정 하한은 user_id 로, login_id 는 보호 컬럼
-- ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_crew_referrer(p_login_id TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE v_in TEXT := trim(COALESCE(p_login_id, '')); v_id UUID;
BEGIN
  IF length(v_in) < 3 OR length(v_in) > 254 THEN RETURN NULL; END IF;
  IF position('@' IN v_in) > 0 THEN
    SELECT id INTO v_id FROM public.profiles
     WHERE (lower(email) = lower(v_in) OR lower(airline_email) = lower(v_in))
       AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM public.profiles
     WHERE (referral_code = upper(v_in) OR login_id = public.normalize_login_id(v_in))
       AND user_type = 'crew' AND COALESCE(crew_verified, FALSE) LIMIT 1;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
DECLARE
  v_floor  INT;
  v_bypass BOOLEAN;
BEGIN
  v_bypass := (auth.uid() IS NULL)
              OR (COALESCE(current_setting('app.allow_sensitive', true), 'off') = 'on')
              OR COALESCE(public.is_admin(), FALSE);

  IF NOT v_bypass THEN
    IF NEW.role                 IS DISTINCT FROM OLD.role
    OR NEW.email                IS DISTINCT FROM OLD.email
    OR NEW.login_id             IS DISTINCT FROM OLD.login_id
    OR NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at
    OR NEW.airline              IS DISTINCT FROM OLD.airline
    OR NEW.is_banned            IS DISTINCT FROM OLD.is_banned
    OR NEW.points_balance       IS DISTINCT FROM OLD.points_balance
    OR NEW.available_likes      IS DISTINCT FROM OLD.available_likes
    OR NEW.voucher_count        IS DISTINCT FROM OLD.voucher_count
    OR NEW.user_type            IS DISTINCT FROM OLD.user_type
    OR NEW.crew_verified        IS DISTINCT FROM OLD.crew_verified
    OR NEW.phone_verified       IS DISTINCT FROM OLD.phone_verified
    OR NEW.identity_verified    IS DISTINCT FROM OLD.identity_verified
    OR NEW.verification_method  IS DISTINCT FROM OLD.verification_method
    OR NEW.verified_at          IS DISTINCT FROM OLD.verified_at
    OR NEW.verification_required IS DISTINCT FROM OLD.verification_required
    OR NEW.referral_bonus_given IS DISTINCT FROM OLD.referral_bonus_given
    OR NEW.referred_by          IS DISTINCT FROM OLD.referred_by
    OR NEW.referral_code        IS DISTINCT FROM OLD.referral_code
    OR NEW.profile_completed    IS DISTINCT FROM OLD.profile_completed
    OR NEW.phone                IS DISTINCT FROM OLD.phone
    OR NEW.airline_email        IS DISTINCT FROM OLD.airline_email
    OR NEW.airline_name         IS DISTINCT FROM OLD.airline_name
    OR NEW.crew_verified_at     IS DISTINCT FROM OLD.crew_verified_at
    THEN
      RAISE EXCEPTION 'protected column modification denied';
    END IF;
  END IF;

  -- 시험 계정 포인트 하한: user_id 키 우선(연락 이메일이 바뀌어도 유지), 구 이메일 키 폴백 — 순서 고정(codex 지적)
  SELECT min_points INTO v_floor FROM public.test_account_floors
   WHERE user_id = NEW.id OR (user_id IS NULL AND email = NEW.email)
   ORDER BY (user_id = NEW.id) DESC NULLS LAST LIMIT 1;
  IF v_floor IS NOT NULL AND COALESCE(NEW.points_balance, 0) < v_floor THEN
    NEW.points_balance := v_floor;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------------------
-- 5. 확인 쿼리
-- ----------------------------------------------------------------------------------------
-- SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname LIKE 'complete_signup_profile%';   -- 3개(for/래퍼2), 구 16인자 없음
-- SELECT public.check_login_id_taken('admin'), public.check_login_id_taken('kuma_01');  -- true, false

-- ----------------------------------------------------------------------------------------
-- 6. (참고) 클라이언트 롤 권한: check_login_id_taken 만 공개. login_id_contact·password_reset_by_identity·revoke_user_sessions 는 service_role.
-- 7. 시험 계정 3개 이행 (별도 마이그레이션 loginid_migrate_test_accounts — 서버 API 배포 후 실행)
--    예약어 충돌 때문에 test/crew/admin 대신 cttest/ctcrew/ctadmin. auth.users.email 만 바꾸면 GoTrue 가
--    auth.identities.identity_data.email 과 어긋나 비밀번호 로그인이 실패하므로 같은 트랜잭션에서 동기화한다(agy 지적).
--    연락 이메일(profiles.email)은 그대로(test@connectrip.com 등) 둔다. 이행 후 계정별 아이디 로그인 E2E 필수.
-- ----------------------------------------------------------------------------------------
-- WITH m(old_email, login_id) AS (VALUES
--   ('test@connectrip.com', 'cttest'), ('crew@connectrip.com', 'ctcrew'), ('admin@connectrip.com', 'ctadmin'))
-- , u AS (
--   UPDATE auth.users a SET email = m.login_id || '@id.connecttrip.co.kr',
--          raw_user_meta_data = jsonb_set(COALESCE(a.raw_user_meta_data,'{}'::jsonb), '{login_id}', to_jsonb(m.login_id)),
--          updated_at = NOW()
--     FROM m WHERE lower(a.email) = m.old_email RETURNING a.id, m.login_id)
-- , i AS (
--   UPDATE auth.identities idn SET identity_data = jsonb_set(idn.identity_data, '{email}', to_jsonb(u.login_id || '@id.connecttrip.co.kr')),
--          updated_at = NOW()
--     FROM u WHERE idn.user_id = u.id AND idn.provider = 'email' RETURNING idn.user_id)
-- UPDATE public.profiles p SET login_id = u.login_id, updated_at = NOW() FROM u WHERE p.id = u.id;
-- ----------------------------------------------------------------------------------------
