-- ============================================================
-- ConnectTrip — 통신사 휴대폰 본인확인(PASS/SMS) 가입 연동 (2026-09-02)
--   흐름: 본인확인 먼저(포트원 V2 → PG 휴대폰 본인확인) → 가입 폼.
--   서버(api/verify-identity.js)가 포트원에서 결과를 조회해 record_identity_verification 으로
--   기록 + 일회성 소비 토큰을 발급하고, complete_signup_profile 이 토큰을 소비하며
--   이름·생년월일·휴대폰을 "본인확인기관 값"으로 확정한다(클라 값 불신).
--   ★ 이 파일이 complete_signup_profile / request_account_deletion 의 단일 소스다
--     (security_hardening.sql·legal_20260711.sql 의 정의는 이 파일로 대체됨).
--   적용: Supabase MCP apply_migration(identity_verification_20260902). 멱등.
-- ============================================================

-- ------------------------------------------------------------
-- 0. 런타임 플래그 — identity_required
--    'false'(기본): 본인확인 토큰이 없으면 기존 SMS OTP 경로 허용(PG 계약 전 기간).
--    'true'        : 토큰 없는 가입을 IDENTITY_REQUIRED 로 거부. 실키 배포·실인증 검증 후 전환.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_flags (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_flags FROM PUBLIC, anon, authenticated;
INSERT INTO public.app_flags (key, value) VALUES ('identity_required', 'false')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 1. 본인확인 임시 기록 (서버 전용). 소비되면 PII 를 즉시 NULL 처리, 미소비 24h 초과는 삭제.
--    RLS ON + 정책 없음 + anon/authenticated REVOKE = service_role/SECURITY DEFINER 만 접근.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL DEFAULT 'portone',
  provider_ref       TEXT NOT NULL UNIQUE,        -- 포트원 identityVerificationId (재사용 차단)
  pg                 TEXT,                        -- 'KCP' | 'DANAL' 등 포트원 channel.pgProvider
  name               TEXT,
  birthdate          DATE,
  gender             TEXT,
  phone              TEXT,
  operator           TEXT,
  is_foreigner       BOOLEAN,
  ci_hash            TEXT,                        -- sha256(CI) — 원문 CI 는 저장하지 않는다
  ip_address         TEXT,
  purpose            TEXT NOT NULL DEFAULT 'signup_identity',
  verified_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consume_token_hash TEXT UNIQUE,                 -- 일회성 토큰의 sha256(원문은 클라에만)
  consumed_at        TIMESTAMPTZ,
  consumed_by        UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_ip_created
  ON public.identity_verifications (ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_unconsumed
  ON public.identity_verifications (created_at) WHERE consumed_at IS NULL;
ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_verifications FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. 회원별 본인확인 확정값 (서버 전용). CI 해시 UNIQUE = 1인 1계정.
--    auth.users 삭제(탈퇴) 시 CASCADE 로 슬롯 반납 → 정상 탈퇴자는 재가입 가능.
--    개인정보 최소화: CI 원문·DI 는 저장하지 않는다(중복 판정은 ci_hash 하나로 충분).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles_identity (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ci_hash      TEXT NOT NULL UNIQUE,
  provider     TEXT,
  pg           TEXT,
  operator     TEXT,
  is_foreigner BOOLEAN,
  gender       TEXT,
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.profiles_identity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles_identity FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. 차단(is_banned) 상태로 탈퇴한 사람의 CI 해시 — 번호를 바꿔 재가입하는 세탁 차단.
--    blocked_phone_claims 와 같은 정책(정상 탈퇴자는 기록하지 않음, 관리자 해제 가능).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_identity_claims (
  ci_hash     TEXT PRIMARY KEY,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT,
  released_at TIMESTAMPTZ,
  released_by UUID,
  note        TEXT
);
ALTER TABLE public.blocked_identity_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_identity_claims FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3b. 포트원 조회 남용 방어 — IP 별 10분 버킷(원자적 UPSERT). verify-identity 가 포트원을 호출하기
--     "전에" 부른다(성공 기록 테이블을 rate limit 근거로 쓰면 실패·위조 요청은 안 세어진다 — codex 지적).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_rate_buckets (
  ip           TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
ALTER TABLE public.identity_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_rate_buckets FROM PUBLIC, anon, authenticated;

-- 반환: 이번 요청을 포함한 10분 창 누적 횟수. 호출측은 > p_limit 이면 429.
CREATE OR REPLACE FUNCTION public.identity_rate_hit(p_ip TEXT, p_limit INT DEFAULT 10)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_win TIMESTAMPTZ; v_hits INT;
BEGIN
  IF COALESCE(btrim(p_ip), '') = '' THEN RETURN 0; END IF;
  v_win := date_trunc('hour', NOW()) + (floor(extract(minute FROM NOW()) / 10) * INTERVAL '10 minutes');
  -- 오래된 버킷 정리(값싼 부수 작업)
  DELETE FROM public.identity_rate_buckets WHERE window_start < NOW() - INTERVAL '1 hour';
  INSERT INTO public.identity_rate_buckets (ip, window_start, hits) VALUES (p_ip, v_win, 1)
  ON CONFLICT (ip, window_start) DO UPDATE SET hits = public.identity_rate_buckets.hits + 1
  RETURNING hits INTO v_hits;
  RETURN v_hits;
END;
$$;
REVOKE ALL ON FUNCTION public.identity_rate_hit(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_rate_hit(TEXT, INT) TO service_role;

-- ------------------------------------------------------------
-- 4. 본인확인 결과 기록 + 소비 토큰 발급 (서버리스 verify-identity 전용, service_role 로만 호출)
--    차단·중복 검사가 INSERT 보다 먼저라 차단 대상의 PII 는 저장되지 않는다.
--    반환 코드: ok | already_used | ci_registered | phone_claimed | blocked
--               | under_14 | birth_invalid | phone_invalid
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_identity_verification(
  p_provider_ref TEXT, p_pg TEXT, p_name TEXT, p_birthdate DATE, p_gender TEXT,
  p_phone TEXT, p_operator TEXT, p_is_foreigner BOOLEAN, p_ci_hash TEXT,
  p_token_hash TEXT, p_purpose TEXT DEFAULT 'signup_identity', p_ip TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_clean_phone TEXT; v_phone_hash TEXT;
BEGIN
  IF COALESCE(btrim(p_provider_ref), '') = '' OR COALESCE(btrim(p_ci_hash), '') = ''
     OR COALESCE(btrim(p_token_hash), '') = '' OR COALESCE(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'invalid args';
  END IF;

  -- 임시 저장 최소화: 미소비 24h 초과 행은 여기서 정리한다(부분 인덱스로 저렴).
  DELETE FROM public.identity_verifications
   WHERE consumed_at IS NULL AND created_at < NOW() - INTERVAL '24 hours';

  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF v_clean_phone !~ '^01[016789][0-9]{7,8}$' THEN RETURN 'phone_invalid'; END IF;
  IF p_birthdate IS NULL OR p_birthdate > CURRENT_DATE OR p_birthdate < DATE '1900-01-01' THEN RETURN 'birth_invalid'; END IF;
  IF p_birthdate > (CURRENT_DATE - INTERVAL '14 years') THEN RETURN 'under_14'; END IF;

  IF EXISTS (SELECT 1 FROM public.identity_verifications WHERE provider_ref = p_provider_ref) THEN
    RETURN 'already_used';
  END IF;

  IF EXISTS (SELECT 1 FROM public.blocked_identity_claims WHERE ci_hash = p_ci_hash AND released_at IS NULL) THEN
    RETURN 'blocked';
  END IF;
  v_phone_hash := encode(extensions.digest(public.canon_phone(v_clean_phone), 'sha256'), 'hex');
  IF EXISTS (SELECT 1 FROM public.blocked_phone_claims WHERE phone_hash = v_phone_hash AND released_at IS NULL) THEN
    RETURN 'blocked';
  END IF;

  -- 이미 이 사람(CI)이 살아있는 계정을 가짐 → 가입 대신 로그인/계정찾기 안내
  IF EXISTS (SELECT 1 FROM public.profiles_identity WHERE ci_hash = p_ci_hash) THEN
    RETURN 'ci_registered';
  END IF;
  -- 휴대폰 1개 = 계정 1개 (profile_completed 된 계정만 점유로 본다 — 진행 중인 본인 가입행과 충돌 방지)
  IF EXISTS (SELECT 1 FROM public.profiles
              WHERE public.canon_phone(phone) = public.canon_phone(v_clean_phone)
                AND COALESCE(profile_completed, FALSE)) THEN
    RETURN 'phone_claimed';
  END IF;

  INSERT INTO public.identity_verifications
    (provider_ref, pg, name, birthdate, gender, phone, operator, is_foreigner, ci_hash,
     consume_token_hash, purpose, ip_address)
  VALUES
    (p_provider_ref, p_pg, btrim(p_name), p_birthdate, p_gender, v_clean_phone, p_operator,
     p_is_foreigner, p_ci_hash, p_token_hash, COALESCE(NULLIF(btrim(p_purpose), ''), 'signup_identity'), p_ip);
  RETURN 'ok';
EXCEPTION WHEN unique_violation THEN
  RETURN 'already_used';
END;
$$;
REVOKE ALL ON FUNCTION public.record_identity_verification(TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_identity_verification(TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT,BOOLEAN,TEXT,TEXT,TEXT,TEXT)
  TO service_role;

-- ------------------------------------------------------------
-- 5. 가입 완료 RPC — 16인자 (p_identity_token 추가)
--    · 토큰 있음: identity_verifications 행 소비(1h·1회) → 이름·생년월일·휴대폰을 행 값으로 확정,
--                차단 CI / 등록된 CI 검사, profiles_identity 기록, identity_verified=TRUE,
--                verification_method='carrier_auth'. phone_otps 소비는 건너뛴다.
--    · 토큰 없음: app_flags.identity_required='true' 면 IDENTITY_REQUIRED, 아니면 기존 SMS OTP 경로.
--                (버그 수정) verification_method 를 'sms_otp' 로 명시 — 종전 COALESCE 는 트리거가
--                넣은 'sms_otp_pending' 을 영원히 못 바꿨다.
--    · 동의 policy_version '2026-09-02' (개인정보처리방침 개정: 본인확인 항목·수탁자 추가).
--    ★ 15인자 시그니처는 아래에서 DROP 한다(오버로딩 모호성 → 가입 전면 실패 방지).
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.complete_signup_profile(
  p_name TEXT, p_nickname TEXT, p_phone TEXT,
  p_zipcode TEXT, p_road TEXT, p_detail TEXT,
  p_user_type TEXT, p_airline_email TEXT, p_airline_name TEXT,
  p_referred_by UUID,
  p_birthdate DATE DEFAULT NULL,
  p_phone_otp_token TEXT DEFAULT NULL,
  p_airline_otp_token TEXT DEFAULT NULL,
  p_terms_agreed_at TIMESTAMPTZ DEFAULT NULL,
  p_privacy_agreed_at TIMESTAMPTZ DEFAULT NULL,
  p_identity_token TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_crew BOOLEAN := FALSE; v_clean_phone TEXT; v_ref UUID; v_domain TEXT;
  v_norm_email TEXT; v_canon TEXT; v_hash TEXT; v_otp_id UUID; v_owner UUID;
  v_airline TEXT; v_prev UUID; v_blocked BOOLEAN;
  v_policy_version CONSTANT TEXT := '2026-09-02';
  v_identity_required BOOLEAN := FALSE;
  v_has_identity BOOLEAN := FALSE;
  v_name TEXT; v_birthdate DATE;
  v_idv_id UUID; v_idv_name TEXT; v_idv_birthdate DATE; v_idv_phone TEXT; v_idv_ci_hash TEXT;
  v_idv_provider TEXT; v_idv_pg TEXT; v_idv_operator TEXT; v_idv_foreigner BOOLEAN; v_idv_gender TEXT;
  v_constraint TEXT;
BEGIN
  -- 필수 동의 강제(개인정보보호법 제15조·제22조)
  IF p_terms_agreed_at IS NULL OR p_privacy_agreed_at IS NULL THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_user_type NOT IN ('traveler', 'crew') THEN RAISE EXCEPTION 'invalid user_type'; END IF;

  SELECT (value = 'true') INTO v_identity_required FROM public.app_flags WHERE key = 'identity_required';
  v_identity_required := COALESCE(v_identity_required, FALSE);

  v_name := btrim(COALESCE(p_name, ''));
  v_birthdate := p_birthdate;
  v_clean_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');

  IF COALESCE(btrim(p_identity_token), '') <> '' THEN
    -- [본인확인 경로] 일회성 토큰 소비. UPDATE 자체가 행 잠금이라 동시 소비 경쟁이 없다.
    UPDATE public.identity_verifications
       SET consumed_at = NOW(), consumed_by = auth.uid()
     WHERE consume_token_hash = encode(extensions.digest(p_identity_token, 'sha256'), 'hex')
       AND purpose = 'signup_identity'
       AND verified_at > NOW() - INTERVAL '1 hour'
       AND consumed_at IS NULL AND consumed_by IS NULL
    RETURNING id, name, birthdate, phone, ci_hash, provider, pg, operator, is_foreigner, gender
      INTO v_idv_id, v_idv_name, v_idv_birthdate, v_idv_phone, v_idv_ci_hash,
           v_idv_provider, v_idv_pg, v_idv_operator, v_idv_foreigner, v_idv_gender;
    IF v_idv_id IS NULL OR v_idv_ci_hash IS NULL THEN RAISE EXCEPTION 'IDENTITY_PROOF_INVALID'; END IF;
    v_has_identity := TRUE;
    -- 클라이언트 값 대신 본인확인기관 값으로 확정
    v_name := v_idv_name;
    v_birthdate := v_idv_birthdate;
    v_clean_phone := v_idv_phone;

    IF EXISTS (SELECT 1 FROM public.blocked_identity_claims WHERE ci_hash = v_idv_ci_hash AND released_at IS NULL) THEN
      RAISE EXCEPTION 'IDENTITY_BLOCKED';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles_identity WHERE ci_hash = v_idv_ci_hash AND user_id <> auth.uid()) THEN
      RAISE EXCEPTION 'IDENTITY_ALREADY_REGISTERED';
    END IF;
  ELSIF v_identity_required THEN
    RAISE EXCEPTION 'IDENTITY_REQUIRED';
  END IF;

  IF v_name = '' THEN RAISE EXCEPTION 'name required'; END IF;
  IF v_birthdate IS NULL THEN RAISE EXCEPTION 'birthdate required'; END IF;
  IF v_birthdate > CURRENT_DATE OR v_birthdate < DATE '1900-01-01' THEN RAISE EXCEPTION 'birthdate invalid'; END IF;
  IF v_birthdate > (CURRENT_DATE - INTERVAL '14 years') THEN RAISE EXCEPTION 'age_under_14'; END IF;

  -- 차단된 상태로 탈퇴한 번호는 재가입 불가 (정상 탈퇴자는 해당 없음)
  SELECT TRUE INTO v_blocked FROM public.blocked_phone_claims
   WHERE phone_hash = encode(extensions.digest(public.canon_phone(v_clean_phone), 'sha256'), 'hex')
     AND released_at IS NULL LIMIT 1;
  IF v_blocked THEN RAISE EXCEPTION 'PHONE_BLOCKED'; END IF;

  -- 휴대폰 1개 = 계정 1개
  SELECT id INTO v_owner FROM public.profiles
   WHERE public.canon_phone(phone) = public.canon_phone(v_clean_phone) AND id <> auth.uid() LIMIT 1;
  IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'PHONE_ALREADY_CLAIMED'; END IF;

  IF NOT v_has_identity THEN
    -- [SMS OTP 경로] identity_required='false' 인 동안만 도달
    IF COALESCE(btrim(p_phone_otp_token), '') = '' THEN RAISE EXCEPTION 'OTP_PROOF_REQUIRED_PHONE'; END IF;
    UPDATE public.phone_otps SET consumed_at = NOW()
     WHERE phone = v_clean_phone AND verified_at IS NOT NULL
       AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
       AND purpose = 'signup_phone'
       AND consume_token_hash = encode(extensions.digest(p_phone_otp_token, 'sha256'), 'hex')
    RETURNING id INTO v_otp_id;
    IF v_otp_id IS NULL THEN RAISE EXCEPTION 'OTP_PROOF_INVALID_PHONE'; END IF;
  END IF;

  IF p_user_type = 'crew' THEN
    v_norm_email := lower(trim(COALESCE(p_airline_email, '')));
    v_domain := split_part(v_norm_email, '@', 2);
    SELECT domain INTO v_airline FROM public.airline_domains WHERE domain = v_domain;
    v_crew := (v_airline IS NOT NULL);
    IF NOT v_crew THEN RAISE EXCEPTION 'crew airline verification required'; END IF;

    v_canon := public.canon_airline_email(v_norm_email);
    v_hash  := encode(extensions.digest(v_canon, 'sha256'), 'hex');

    SELECT id INTO v_owner FROM public.profiles
     WHERE public.canon_airline_email(airline_email) = v_canon AND id <> auth.uid() LIMIT 1;
    IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'AIRLINE_EMAIL_ALREADY_CLAIMED'; END IF;

    SELECT claimed_by INTO v_prev FROM public.airline_email_claims
     WHERE email_hash = v_hash AND released_at IS NULL LIMIT 1;
    IF FOUND AND v_prev IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'AIRLINE_EMAIL_PREVIOUSLY_USED';
    END IF;

    IF COALESCE(btrim(p_airline_otp_token), '') = '' THEN RAISE EXCEPTION 'OTP_PROOF_REQUIRED_AIRLINE'; END IF;
    UPDATE public.email_otps SET consumed_at = NOW()
     WHERE lower(email) = v_norm_email AND verified_at IS NOT NULL
       AND verified_at > NOW() - INTERVAL '1 hour' AND consumed_at IS NULL
       AND purpose = 'airline_email'
       AND consume_token_hash = encode(extensions.digest(p_airline_otp_token, 'sha256'), 'hex')
    RETURNING id INTO v_otp_id;
    IF v_otp_id IS NULL THEN RAISE EXCEPTION 'OTP_PROOF_INVALID_AIRLINE'; END IF;

    INSERT INTO public.airline_email_claims (email_hash, domain, claimed_by)
    VALUES (v_hash, v_domain, auth.uid())
    ON CONFLICT (email_hash) DO UPDATE
      SET claimed_by = EXCLUDED.claimed_by, claimed_at = NOW(), released_at = NULL, released_by = NULL;
  END IF;

  v_ref := p_referred_by;
  IF v_ref = auth.uid() THEN v_ref := NULL; END IF; -- self-referral 차단
  -- 추천인은 "인증 승무원"만 유효. UI(find_crew_referrer) 우회 임의 UUID 서버 차단.
  IF v_ref IS NOT NULL THEN
    SELECT CASE WHEN (user_type = 'crew' AND COALESCE(crew_verified, FALSE)) THEN v_ref ELSE NULL END
      INTO v_ref FROM public.profiles WHERE id = v_ref;
  END IF;

  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET
    name = v_name, nickname = p_nickname, phone = v_clean_phone, phone_verified = TRUE,
    verification_method   = CASE WHEN v_has_identity THEN 'carrier_auth' ELSE 'sms_otp' END,
    identity_verified     = CASE WHEN v_has_identity THEN TRUE  ELSE COALESCE(identity_verified, FALSE) END,
    verified_at           = CASE WHEN v_has_identity THEN NOW() ELSE verified_at END,
    verification_required = CASE WHEN v_has_identity THEN FALSE ELSE verification_required END,
    address_zipcode = p_zipcode, address_road = p_road, address_detail = p_detail,
    user_type = p_user_type,
    airline_email = CASE WHEN v_crew THEN v_norm_email ELSE airline_email END,
    airline_name  = CASE WHEN v_crew THEN COALESCE(p_airline_name, v_airline) ELSE airline_name END,
    crew_verified = CASE WHEN v_crew THEN TRUE ELSE crew_verified END,
    crew_verified_at = CASE WHEN v_crew THEN NOW() ELSE crew_verified_at END,
    referred_by = COALESCE(referred_by, v_ref), profile_completed = TRUE, updated_at = NOW()
  WHERE id = auth.uid();

  IF v_has_identity THEN
    -- 1인 1계정 확정. ci_hash UNIQUE 충돌(동시 가입 경쟁)은 아래 EXCEPTION 에서 매핑.
    INSERT INTO public.profiles_identity (user_id, ci_hash, provider, pg, operator, is_foreigner, gender, verified_at)
    VALUES (auth.uid(), v_idv_ci_hash, v_idv_provider, v_idv_pg, v_idv_operator, v_idv_foreigner, v_idv_gender, NOW())
    ON CONFLICT (user_id) DO UPDATE
      SET ci_hash = EXCLUDED.ci_hash, provider = EXCLUDED.provider, pg = EXCLUDED.pg,
          operator = EXCLUDED.operator, is_foreigner = EXCLUDED.is_foreigner,
          gender = EXCLUDED.gender, verified_at = NOW();
    -- 임시행 PII 즉시 파기(감사용 provider_ref·consumed_by·시각만 남긴다)
    UPDATE public.identity_verifications
       SET name = NULL, birthdate = NULL, phone = NULL, gender = NULL, operator = NULL,
           is_foreigner = NULL, ci_hash = NULL, ip_address = NULL
     WHERE id = v_idv_id;
  END IF;

  INSERT INTO public.profiles_private (user_id, birthdate)
  VALUES (auth.uid(), v_birthdate)
  ON CONFLICT (user_id) DO UPDATE SET birthdate = EXCLUDED.birthdate;

  -- 동의 이력. 시각은 클라이언트가 보낸 값을 믿지 않고 서버 시각(NOW())으로 남긴다.
  IF p_terms_agreed_at IS NOT NULL THEN
    INSERT INTO public.user_consents (user_id, policy_type, policy_version)
    VALUES (auth.uid(), 'terms', v_policy_version);
  END IF;
  IF p_privacy_agreed_at IS NOT NULL THEN
    INSERT INTO public.user_consents (user_id, policy_type, policy_version)
    VALUES (auth.uid(), 'privacy', v_policy_version);
    INSERT INTO public.user_consents (user_id, policy_type, policy_version)
    VALUES (auth.uid(), 'age14', v_policy_version);
  END IF;

  IF v_ref IS NOT NULL THEN PERFORM public.grant_referral_bonus(auth.uid()); END IF;
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  IF v_constraint = 'profiles_identity_ci_hash_key' THEN RAISE EXCEPTION 'IDENTITY_ALREADY_REGISTERED'; END IF;
  IF v_constraint = 'uq_profiles_phone_canon' THEN RAISE EXCEPTION 'PHONE_ALREADY_CLAIMED'; END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_signup_profile(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,DATE,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT)
  TO authenticated;

-- ------------------------------------------------------------
-- 6. 탈퇴 RPC — 라이브 정의(2026-08-07 blocked_phone_claims 포함) 기준 + CI 차단 기록 추가.
--    is_banned 상태 탈퇴 시 profiles_identity.ci_hash 를 blocked_identity_claims 에 남긴다.
--    profiles_identity 자체는 auth.users CASCADE 로 파기된다.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_phone  TEXT;
  v_banned BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT email, phone, COALESCE(is_banned, FALSE) INTO v_email, v_phone, v_banned
    FROM public.profiles WHERE id = v_uid;

  -- (1) 법정 보존 대상(결제·포인트 거래기록)을 분리보관 아카이브로 이관
  INSERT INTO public.account_deletion_archive(user_id, email_hash, point_transactions, retention_until)
  VALUES (
    v_uid,
    md5(COALESCE(v_email, '')),
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at)
              FROM public.point_transactions t WHERE t.user_id = v_uid), '[]'::jsonb),
    (CURRENT_DATE + INTERVAL '5 years')::date
  );

  -- (1b) 차단된 상태로 탈퇴하는 경우에만 번호를 영구 기록해 재가입을 막는다.
  --      정상 탈퇴자는 기록하지 않으므로 같은 번호로 다시 가입할 수 있다(쿠마님 확정 3안).
  IF v_banned AND public.canon_phone(v_phone) IS NOT NULL THEN
    INSERT INTO public.blocked_phone_claims(phone_hash, source)
    VALUES (encode(extensions.digest(public.canon_phone(v_phone), 'sha256'), 'hex'), 'banned_self_deletion')
    ON CONFLICT (phone_hash) DO UPDATE
      SET blocked_at = NOW(), released_at = NULL, released_by = NULL, source = 'banned_self_deletion';
  END IF;
  -- (1c) 차단 탈퇴자의 본인확인 CI 해시도 기록(번호 변경 후 재가입 세탁 차단)
  IF v_banned THEN
    INSERT INTO public.blocked_identity_claims(ci_hash, source)
    SELECT ci_hash, 'banned_self_deletion' FROM public.profiles_identity WHERE user_id = v_uid
    ON CONFLICT (ci_hash) DO UPDATE
      SET blocked_at = NOW(), released_at = NULL, released_by = NULL, source = 'banned_self_deletion';
  END IF;

  -- (2) 트리거 우회 플래그(트랜잭션 로컬) — 타인 referred_by 수정 + 이후 매칭 SET NULL 카스케이드 허용
  PERFORM set_config('app.allow_sensitive', 'on', true);
  UPDATE public.profiles SET referred_by = NULL, updated_at = NOW() WHERE referred_by = v_uid;

  -- OTP·본인확인 임시기록(PII) 정리 — user_id FK 는 없고 값으로 매칭
  IF v_email IS NOT NULL THEN DELETE FROM public.email_otps WHERE email = v_email; END IF;
  IF v_phone IS NOT NULL AND v_phone <> '' THEN
    DELETE FROM public.phone_otps WHERE phone = v_phone;
    DELETE FROM public.identity_verifications WHERE phone = v_phone AND consumed_at IS NULL;
  END IF;

  -- (3) 신원 삭제 → profiles + CASCADE 자식 전체 파기(profiles_private·profiles_identity 포함),
  --     쪽지/매칭은 SET NULL 익명화
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

-- ------------------------------------------------------------
-- 7. 관리자 해제 — 차단 CI 기록 해제(정당한 사유). ci_hash 는 관리자가 profiles_identity 를
--    service_role 로 조회해 얻는다(클라 노출 없음).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_release_identity(p_ci_hash TEXT, p_note TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  IF NOT COALESCE(public.is_admin(), FALSE) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.blocked_identity_claims
     SET released_at = NOW(), released_by = auth.uid(), note = COALESCE(p_note, note)
   WHERE ci_hash = p_ci_hash AND released_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_release_identity(TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_identity(TEXT,TEXT) TO authenticated;

-- ============================================================
-- 끝. 롤백: DROP FUNCTION complete_signup_profile(16인자) 후 security_hardening.sql 의 15인자
--   정의 재실행; request_account_deletion 은 이 파일의 (1c)·identity_verifications 정리 줄만 제거;
--   테이블 5개(app_flags/identity_verifications/profiles_identity/blocked_identity_claims/
--   identity_rate_buckets)와 identity_rate_hit·record_identity_verification·admin_release_identity 는 DROP.
-- ============================================================
